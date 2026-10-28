# Clube do livro de Paracuru

Página de pesquisa com 14 perguntas, revisão antes do envio e painel privado de acompanhamento. Interface estática em HTML/CSS/JavaScript; respostas centralizadas em PostgreSQL no Supabase, por uma Edge Function que valida e autoriza as operações.

## Estado desta entrega

O site foi publicado em https://caue-a11y.github.io/clube-do-livro-paracuru/ e o backend está implantado no projeto gratuito do Supabase. Consulte VALIDACAO.md para o que realmente foi executado. A coleta começa fechada: não há responsável/canal de privacidade nem retenção definidos pelo organizador. Nenhum dado real deve ser coletado antes dessa configuração. Não há administrador com senha pública ou dados de demonstração misturados na base.

O repositório público https://github.com/caue-a11y/clube-do-livro-paracuru foi criado após login seguro no navegador. GitHub Pages está ativo na branch main, pasta raiz; URL público e conexão com a API foram conferidos no navegador. Consulte VALIDACAO.md e docs/PUBLICACAO.md para as verificações e pendências.

## Estrutura

- index.html, src/public.js e src/styles.css: apresentação, etapas e revisão.
- admin.html e src/admin.js: login privado, respostas, compatibilidade, filtros e operação.
- src/config.js: URL e chave publicável. A chave publicável identifica o projeto; não concede acesso às respostas.
- supabase/: migração SQL e função clube-api. Segredos ficam no ambiente do provedor, nunca no site.
- shared/questionario.json: fonte original dos textos/IDs e versão.
- shared/analysis.js: regras testáveis de compatibilidade e distribuição.
- tests/: testes automáticos sem dependências de instalação.
- scripts/package_site.py: pacote público em _site, excluindo backend e documentos.

## Executar a interface para revisão local

Com Node.js 24 e Python 3 instalados, npm test executa os testes e npm run check verifica a sintaxe. npm run preview abre o servidor estático local na porta 4173; acesse o endereço local mostrado pelo comando no seu próprio computador. Não é um servidor de recebimento local: a persistência usa a API Supabase configurada.

Não há dependências npm para instalar nem build JavaScript. Não use localStorage para guardar respostas ou contato. O rascunho é perdido ao recarregar; a interface avisa quando o navegador permite.

## Configurar o acesso do organizador

1. No painel do projeto Supabase, Authentication > Users, crie o usuário administrativo por canal seguro com email/senha próprios. Não envie a senha no chat, não a publique no repositório e não use conta de exemplo. Se habilitar confirmação de email/recuperação, configure o provedor de email e os limites de envio do Supabase.
2. Adicione exclusivamente o UUID desse usuário em public.admin_users no editor SQL autenticado. O arquivo docs/OPERACAO.md explica a operação. Uma conta autenticada sem essa autorização continua impedida de acessar respostas.
3. Entre por admin.html. A sessão permanece só na memória da aba e é verificada no servidor. Fechar/recarregar exige novo login.
4. Preencha responsável, canal de privacidade real e retenção; revise o aviso e só então abra a coleta. Abrir a coleta não confirma inscrição nem presença em encontro.

Essa escolha usa o fluxo oficial Supabase Auth com token em memória, em vez de cookies HttpOnly do servidor próprio sugerido no pacote original. Não há cookies administrativos compartilhados entre GitHub Pages e Supabase, nem segredo no bundle.

## Publicar

O destino solicitado é a conta GitHub caue-a11y, com repositório sugerido clube-do-livro-paracuru. A criação foi feita pelo navegador autenticado e o código enviado pela integração. Não publicar em outra conta como substituição.

Depois do upload, em Settings > Pages, selecione Deploy from a branch, branch main e pasta / (root). Como a interface não requer build, esse é o caminho mais simples. O arquivo .nojekyll evita processamento Jekyll. Os testes foram executados antes da entrega; o workflow opcional de teste/build está documentado em docs/exemplos/pages-workflow.yml e não fica ativo em paralelo com a publicação por branch. Confira o endereço efetivamente retornado pelo GitHub e valide HTTPS, respostas, painel privado e exclusão de um teste identificado. Não trate o URL do repositório como URL do formulário.

A função do Supabase deve ser publicada com o nome clube-api. O gateway JWT dessa função fica desabilitado porque o formulário é público, mas toda rota administrativa valida o token no Supabase Auth e o UUID na allowlist do banco. A função não oferece leitura pública de respostas. Origens CORS autorizadas estão explícitas no código; CORS não substitui autorização.

## Privacidade, backup e operação

Veja docs/OPERACAO.md. Exportação CSV é para consulta e cópia local; não substitui backup restaurável. Download contém dados pessoais e precisa ser guardado em local protegido. O plano gratuito não foi tratado como garantia de backup gerenciado; confira os recursos efetivos do plano no painel e os limites de uso atuais.

Não há envios automáticos de mensagens, grupos, cobrança, rastreamento de visitantes ou confirmação automática de presença. Nenhuma promessa de conformidade legal ou gratuidade permanente é feita.

## Referências técnicas consultadas em 28/10/2026

- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/database/postgres/row-level-security

A arte do convite fornecida pelo organizador orientou a identidade; o site usa HTML acessível e desenho vetorial, não uma imagem no lugar do formulário. A skill Humanizer não estava disponível neste ambiente; os textos foram revisados diretamente em português, sem alegar aplicação da skill.
