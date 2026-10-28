# Operação do organizador

## Antes de abrir

A página é uma pesquisa de interesse, não uma inscrição confirmada. O clube ainda não tem data, local, horário exato ou custo definidos. Informe um responsável real, um canal que você acompanha para pedidos de privacidade e um prazo de retenção que possa cumprir. O formulário apresenta finalidade, dados recebidos e como pedir exclusão; a autorização de contato é separada e não vem marcada.

No projeto Supabase, crie sua conta administrativa em Authentication > Users por um canal seguro. O sistema usa autenticação gerenciada; não existe senha compartilhada no código. Depois, autorize o UUID da sua conta em public.admin_users no editor SQL autenticado do projeto. O UUID identifica uma conta, não é senha. Para evitar atribuir acesso à pessoa errada, confira o email no painel antes de autorizar.

Exemplo de comando para o editor SQL do seu projeto (substitua o marcador pelo UUID conferido; não é uma credencial):

    insert into public.admin_users(user_id) values ('UUID-DA-CONTA-DO-ORGANIZADOR');

Não adicione outros usuários sem necessidade. Uma pessoa que criar conta no Supabase Auth não ganha acesso ao painel: a allowlist é verificada pelo servidor. A sessão administrativa só fica na memória da aba; recarregar exige novo login. Não use computador compartilhado sem sair da conta.

## Ler resultados

- Uma resposta é um registro, não uma pessoa única verificada.
- Interesse regular é uma intenção. Confirmação do primeiro encontro é um status lançado pelo organizador após retorno real.
- Filtros diferentes se combinam por E; várias opções dentro do mesmo filtro, por OU.
- Distribuições usam quem respondeu à pergunta como denominador. Perguntas múltiplas podem superar 100% na soma.
- O cenário cruza dia/período, formato e frequência na mesma resposta. Horários variáveis ficam separados. Presencial e online marcados separadamente não significam aceitação de agenda alternada.
- A autorização não dispara mensagem. O contato é feito manualmente fora da aplicação e somente com quem autorizou.

Contato completo aparece no detalhe privado, não na listagem geral. Registros com contato repetido podem representar repetição ou pessoas compartilhando um canal: não os una ou exclua automaticamente.

## Exportar uma cópia para seu PC

No painel, escolha exportar o recorte filtrado ou a base completa, confira a quantidade e confirme o aviso de dados pessoais. O CSV inclui as respostas e contatos autorizados; não inclui observações internas/histórico por padrão. Fórmulas potenciais são neutralizadas. O arquivo baixado deve ficar em pasta protegida e, se possível, disco criptografado. Não coloque exportações no repositório GitHub, pastas públicas ou links abertos.

Essa é a forma simples de manter uma cópia local sem deixar seu PC ligado para receber respostas. CSV serve para análise/cópia de consulta, não para restauração completa do banco.

## Status e exclusão

Mudanças de status são manuais e registradas com autor e instante. Confirmado exige declaração explícita de retorno real; sem autorização de contato, o sistema bloqueia status de acompanhamento. Se outra sessão alterar a resposta, recarregue e revise antes de salvar: não há sobrescrita silenciosa.

Para excluir, abra o registro, confira o nome e protocolo e confirme o alvo solicitado. Isso remove a resposta e o histórico vinculado do banco ativo, mantendo somente identificadores aleatórios e instante numa lista de exclusões restrita. Não use o botão em outro registro como substituto de um registro não encontrado.

Atenda também cópias locais e backups: remover do banco ativo não apaga uma planilha já baixada. Registre a remoção nas cópias sob sua responsabilidade e respeite os limites reais de backups do fornecedor.

## Retenção e fechamento

Fechar a coleta impede novos envios no servidor, mas mantém consulta administrativa. Repetição de tentativa já gravada retorna o mesmo protocolo sem duplicar o registro. Uma tentativa de resposta excluída não pode recriá-la por repetição.

O prazo de retenção é informado e salvo junto do aviso apresentado. Esta versão não deve ser tratada como expurgo automático agendado: o organizador precisa revisar e excluir os registros vencidos, inclusive cópias locais, ou aprovar uma rotina automatizada separada. Não informe um prazo que não consiga executar.

## Backup restaurável e recuperação

Não prometa backups automáticos do plano gratuito. Confira no painel Supabase os recursos disponíveis e a política de logs/backup do projeto antes de abrir a coleta.

Para um backup lógico completo, use as ferramentas oficiais Supabase/PostgreSQL em ambiente de sua confiança, com conexão de banco fornecida pelo painel e credenciais guardadas fora do repositório/chat. Inclua esquema, dados, configurações, autorização administrativa e histórico; credenciais de autenticação e arquivos do provedor têm procedimentos próprios. O CSV do painel não faz esse papel. O ambiente desta entrega só permite HTTPS, não conexão PostgreSQL direta; por isso não declare um dump externo completo como executado aqui.

Procedimento operacional:
1. Feche a coleta e impeça mudanças administrativas enquanto prepara uma cópia consistente.
2. Exporte para armazenamento privado/criptografado e registre data, versão da migração, responsável e data de expiração da cópia. Verifique se o arquivo realmente pode ser lido.
3. Teste a restauração em projeto isolado sem abrir o site ao público, sem enviar mensagens e sem misturar respostas de demonstração na produção.
4. Antes de liberar uma base restaurada, reaplique as exclusões posteriores à data do backup usando public.deletion_log, preservada em registro protegido separado. Remova as respostas/históricos correspondentes e não elimine tombstones enquanto existir backup capaz de recriar esses registros.
5. Confira contagens, autorização administrativa, configurações e RLS; mantenha coleta fechada até concluir a conferência.
6. Expire backups e suas cópias conforme prazo documentado. Registre incidentes sem copiar nomes, contatos ou respostas em logs de suporte.

Na falha de persistência, não anuncie sucesso nem apague o rascunho do participante. Repetir a tentativa usa a mesma chave para recuperar uma confirmação perdida. Nunca publique service_role nem desative a proteção do banco para contornar um erro.

## Voltar uma versão

No GitHub, reverta o commit da interface e republique o workflow. No Supabase, não derrube tabelas que já tenham respostas para desfazer uma tela: feche coleta, faça backup e prepare uma migração corretiva compatível. O banco é a fonte persistente e não deve ser reiniciado em cada publicação.
