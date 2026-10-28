# Validação — 28/10/2026

## Resultado e limites

Implementação da interface pública, painel e backend entregue para integração. Banco gratuito e função clube-api versão 2 implantados no projeto Supabase wmrrscohfibprfqrprzf, região sa-east-1. Duas migrações aplicadas com sucesso. A base real está vazia, sem administrador cadastrado e com coleta fechada.

Estado atualizado às 16:09 BRT: o bloqueio inicial de criação pela integração foi resolvido por login do organizador no navegador. O repositório caue-a11y/clube-do-livro-paracuru foi criado, sem alterar outros repositórios, e o envio pela integração funciona. A publicação no GitHub Pages está em andamento e o endereço só será anunciado depois de validado. A prévia de revisão permanece isolada, sem API ou coleta.

## Verificações executadas

### Automação local

Ambiente: Node.js 24.22.1, Python 3.9.25. Interface sem dependências npm/build. Backend Deno para Supabase Edge; libphonenumber-js 1.13.15/max. SQL validado em PostgreSQL embarcado PGlite 0.3.14, obtido apenas para testes, com integridade SHA-256 conferida; binários não integram a entrega.

Comando sh tests/backend-check.sh: 56 testes passaram, nenhum falhou ou foi ignorado. Registro em docs/testes-automatizados.txt. Esse comando executa testes de regras, transporte HTTP com upstreams simulados, biblioteca real de telefone e SQL real em base temporária. Os testes comuns npm test não baixam o runtime e indicam explicitamente os testes opcionais ignorados quando ele não está presente.

npm run check passou para os módulos da interface e análise. python3 scripts/package_site.py gerou _site somente com arquivos públicos. Os testes não foram substituídos por dados fictícios na aplicação publicada: simulações só existem no ambiente isolado de testes.

Casos cobertos: obrigatoriedade/enums/limites e condições dos 14 itens; contato descartado sem autorização; Instagram e telefone; exclusividade; coerência local/modalidade; idempotência canônica; replay após coleta fechada; conflito de chave/status/revisão; RLS e grants; autorização em cada rota; filtros e fuso; CSV com mais de 1.000 registros; fórmulas, aspas e quebras; falha de serviço sem sucesso fictício; alterações de status auditadas; exclusão com protocolo/revisão e bloqueio de replay excluído; aviso de privacidade versionado e conferido transacionalmente.

Fixture de compatibilidade: presencial sábado/manhã quinzenal = A/B/D/F; regulares A/B/F; regulares contatáveis A/B; variável E. Online B/C; alternado B. Distribuição de gêneros com denominador sete respondentes e duas marcações adicionais, sem inflar o total.

### Projeto Supabase real

Nove probes HTTPS passaram depois do deploy da função v2; evidência em docs/probes-publicos.json:

- Configuração pública retornou HTTP 200 e coleta fechada.
- Lista, detalhe, configuração e CSV sem sessão retornaram HTTP 401.
- Leitura direta da tabela de respostas com chave publicável foi negada (401).
- Novo envio válido com coleta fechada retornou 409, sem registro.
- Envio com campos obrigatórios ausentes retornou 400.
- Origem não autorizada retornou 403.

O teste tests/deployed-transaction.sql foi executado no projeto real dentro de BEGIN/ROLLBACK. Inseriu um registro sintético e confirmou replay após fechamento sem duplicação. A alteração de abertura da coleta ficou apenas na transação não confirmada, portanto nunca ficou visível ao público. A consulta posterior confirmou zero respostas, zero administradores, coleta fechada e dados de privacidade nulos. O teste não equivale a envio público bem-sucedido pelo navegador.

As seis tabelas têm RLS habilitada e privilégios de anon/authenticated revogados. O diagnóstico de segurança Supabase informou apenas seis avisos INFO RLS Enabled No Policy, correspondentes ao bloqueio deliberado de acesso direto: somente o backend service_role acessa tabelas. Não criar policies públicas para silenciar esses avisos. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

### Navegador da prévia isolada

Renderização inicial sem erros de console ou recursos ausentes. Chromium remoto, prévia v1 e integração final v2. Na prévia, teste de interação verificou avanço, erros obrigatórios, revisão, horários variáveis limpando horários fixos e contato visível somente após autorização. Retirar autorização limpou o valor, ocultou o campo e removeu o contato da revisão. O botão de envio permaneceu desabilitado e nenhuma confirmação fictícia foi exibida.

As larguras 320, 390, 768 e 1440 px foram medidas em frames de teste com viewports reais correspondentes, sem rolagem horizontal na abertura do formulário. Nenhum input testado ficou sem label associado. Isso não é teste em aparelhos físicos ou no navegador interno do Instagram, e não comprova conformidade completa de acessibilidade.

### Painel com API simulada

A frente do painel concluiu 17 checagens em Chrome 156, com rede interceptada e 123 registros sintéticos isolados. O relatório local foi conferido e as linhas de resultado estão em docs/painel-testes-simulados.txt. Foram exercitados login/refresh simulados, todas as páginas filtradas, denominadores, compatibilidade, respostas obsoletas, texto hostil, CAS/409, exclusão, CSV, bloqueio de abertura sem privacidade, logout e ausência de allowlist. Login, painel e detalhe expandido não apresentaram overflow nas quatro larguras. Esses resultados não comprovam conta real, autorização ou persistência no Supabase: as pendências integradas abaixo permanecem.

## Critérios com validação ainda pendente

- Fluxo de ponta a ponta no URL público final, do envio no navegador até consulta em conta administrativa real (AC01).
- Persistência confirmada depois de reinício/deploy e recuperação completa de backup externo (AC02 e parte de AC14).
- Login/logout/expiração com conta real do organizador e duas sessões reais simultâneas (partes de AC06/AC16). Autorização e CAS foram testados em camadas isoladas e acesso público foi negado no projeto real.
- Simulação de perda real da confirmação na rede pública, duplo clique e repetição de timeout na interface integrada (parte de AC05/AC12).
- Exportação/detalhe/status no painel conectado com dados de teste identificados, seguida de exclusão, depois de cadastrar o organizador (partes de AC09/AC10).
- Restauração de dump completo em projeto isolado com reaplicação de exclusões e expiração de backups (parte de AC14). Procedimento documentado; não realizado neste ambiente HTTP-only.
- Revisão completa de teclado, leitor de tela, zoom e painel autenticado nas quatro larguras; Safari/iPhone e navegador do Instagram (parte de AC15).
- Teste observado com participantes e organizador reais: não realizado.

## Antes de abrir coleta real

Liberar a publicação na conta GitHub correta, verificar o URL final amigável, cadastrar o acesso administrativo por canal seguro, informar responsável/canal de privacidade e retenção, verificar os limites/logs/backup do fornecedor e completar o fluxo integrado acima. A retenção informada não é um expurgo automático: o organizador precisa executar as exclusões ou aprovar rotina própria. Sem essas condições, manter coleta fechada.
