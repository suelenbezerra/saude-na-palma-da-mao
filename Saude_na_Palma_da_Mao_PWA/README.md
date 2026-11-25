# Saúde na Palma da Mão — PWA com backend (2.1.1)

Aplicativo: https://saude-na-palma-da-mao-six.vercel.app/

Projeto acadêmico de agendamento acessível, com foco em pessoas idosas. Mantém a direção visual Caderno de cuidado e não contém pré-triagem por IA. **As clínicas e as consultas são fictícias. Use dados fictícios no exercício.**

## O que funciona

- Conta online: cadastro, login por telefone e senha, recuperação por código, perfil, exportação e exclusão da conta.
- Consultas: clínicas/especialidades/profissionais, disponibilidade compartilhada, agendamento, histórico, reagendamento, cancelamento e calendário `.ics`.
- Sessões em mais de um navegador/dispositivo; dados persistidos em PostgreSQL no Supabase.
- Proteção de acesso por proprietário; índices únicos impedem reserva concorrente do mesmo profissional e duas consultas da pessoa no mesmo horário.
- Senha com scrypt e sal aleatório; cookies HttpOnly, Secure em HTTPS e SameSite=Lax; sessões e códigos guardados por hash. Recuperação substitui o código e revoga sessões anteriores. Não envia SMS.
- Demonstração local separada, com IndexedDB e funcionamento offline após o primeiro acesso completo. Alterações na conta online exigem internet e não são confirmadas offline.
- Manifest, ícones, Service Worker e cache da interface. A API privada não é armazenada no cache do Service Worker.
- Preferências de leitura/contraste por dispositivo. Painel com 180 sessões sintéticas identificadas, filtros e CSV; os indicadores continuam separados dos registros da conta atual.

Cadastros antigos da versão local não são transferidos automaticamente. Crie uma conta online para compartilhar o acesso entre dispositivos. O telefone identifica a conta, mas sua titularidade não é verificada por SMS.

## Arquitetura e implantação

Um servidor Node.js 24 atende a interface e `/api/*` na mesma origem, sem dependências de produção. A imagem é construída a partir de `Dockerfile`, usando `node:24-alpine`, e executada sem usuário root. A Vercel constrói a imagem OCI com Buildah, publica no Vercel Container Registry e executa o Container Runtime. Não usa GitHub nem repositório Git conectado.

O banco é o projeto Supabase `saude-na-palma-da-mao`, referência `gungfzwsltprcdvjgwap`, região São Paulo (`sa-east-1`). As tabelas são `spm_users`, `spm_sessions`, `spm_bookings`, `spm_events` e `spm_rate_limits`. O SQL está em `backend/schema.sql` e já foi aplicado no projeto remoto. **Não execute esse arquivo novamente no mesmo banco**: ele cria os objetos iniciais, sem apagar ou substituir estruturas existentes.

Todas as tabelas têm RLS ativo e sem permissão para `anon`/`authenticated`. A chave secreta moderna do Supabase é usada somente no backend; a API valida a sessão e filtra o proprietário em cada operação. Funções SQL com `SECURITY INVOKER`, execução restrita ao backend, realizam alterações transacionais. Não usamos o Supabase Auth: a autenticação por telefone/senha é implementada na API deste projeto.

O arquivo `backend/hardening.sql`, também aplicado, restringe o acesso de clientes à função automática `rls_auto_enable()` criada pelo painel do Supabase.

Variáveis configuradas na Vercel:

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL` | URL do projeto |
| `SUPABASE_SECRET_KEY` | Segredo do servidor, nunca exposto no cliente |
| `RATE_LIMIT_SECRET` | Segredo para gerar identificadores de limites de tentativas |
| `APP_ORIGIN` | Origem permitida para alterações |
| `PORT` | Porta HTTP do container, 8080 |

O Dockerfile não incorpora segredos na imagem. Os arquivos `.env*` e as pastas de controle de provedores são excluídos do pacote e do contexto Docker. Consulte `Publicacao_Vercel.json` para identificar a implantação atual.

## Executar localmente

Requisito: Node.js 24 ou superior. Não é necessário instalar pacotes.

```sh
npm start
```

Abra http://localhost:4173. `Iniciar_Windows.cmd` faz o mesmo no Windows. Sem variáveis de ambiente, a demonstração local está disponível e a conta online informa que falta configuração. Não existe fallback silencioso que simule um cadastro remoto bem-sucedido.

Para usar um banco de desenvolvimento próprio, copie `.env.example` para `.env.local` e configure os valores no seu ambiente. Não publique esse arquivo. Defina `APP_ORIGIN=http://localhost:4173`. O comando `npm start` carrega `.env.local` quando existir.

```sh
docker build -t saude-palma .
docker run --rm -p 4173:8080 --env-file .env.local -e PORT=8080 -e HOST=0.0.0.0 saude-palma
```

Na Vercel, o Framework é `Container`. Envie os arquivos do projeto diretamente com a API ou CLI, incluindo `Dockerfile`, `server.cjs`, `backend/api.cjs`, `dist/`, `package.json` e `vercel.json`. As credenciais ficam nas variáveis do projeto, e o GitHub permanece desconectado. Não envie documentos acadêmicos, evidências, arquivos `.env`, `.openai` ou `.vercel`.

## API

As alterações exigem a origem `APP_ORIGIN`; corpos de cadastro/perfil/reserva usam JSON. Sessões são transmitidas por cookie, sem tokens no JavaScript do cliente. Respostas privadas usam `Cache-Control: no-store, private`.

| Método | Rota | Resultado |
| --- | --- | --- |
| GET | `/api/health` | Saúde da API e conexão ao banco |
| GET | `/api/catalog` | Catálogo fictício e próximos dias úteis |
| POST | `/api/auth/register` | Cadastro e código inicial de recuperação |
| POST | `/api/auth/login` | Início de sessão |
| POST | `/api/auth/recover` | Nova senha, novo código e revogação de sessões anteriores |
| POST | `/api/auth/logout` | Revoga a sessão atual |
| GET | `/api/me` | Perfil da sessão, ou `null` |
| GET | `/api/state` | Perfil e consultas da própria conta |
| PATCH | `/api/me` | Atualiza nome e nascimento |
| DELETE | `/api/me` | Exclui conta e registros vinculados; exige `confirm:true` |
| GET/POST | `/api/bookings` | Lista ou cria consultas da própria conta |
| PATCH/DELETE | `/api/bookings/:id` | Reagenda ou cancela a própria consulta |
| GET | `/api/availability` | Horários livres, sem dados de pacientes; parâmetros `professionalId`, `date`, `exclude` opcional |
| GET/POST | `/api/events` | Eventos da própria conta; início de agendamento pode ser registrado pelo cliente |

## Verificações

```sh
npm run check
npm run test:backend
```

Treze testes locais verificam senhas, configuração ausente, origem, validação, cookies, chave secreta moderna, isolamento por usuário, respostas atrasadas durante login/saída, reutilização do cache, agrupamento de requisições, atualizações após gravar e pré-carregamento de horários. Dezessete testes com o PostgreSQL remoto verificaram cadastro, login em outra sessão, disputa simultânea de horário, isolamento, disponibilidade individual e em lote, conflito da pessoa, reagendamento transacional, cancelamento, perfil, recuperação, limite de tentativas, logout e exclusão. As contas temporárias desses testes foram removidas. Os resultados da versão atual usam o sufixo `v21` em `evidencias/`.

## Navegação e cache em memória — versão 2.1

A troca entre telas utiliza os dados já carregados da conta. Não espera uma chamada de rede para renderizar. Início, Conta e Consultas podem revalidar dados em segundo plano após 30 segundos; Ajustar leitura e mudanças de fonte/contraste não precisam de chamadas à API. Retornar à aba ou recuperar a conexão também permite revalidar dados quando necessário. Formulários em edição não são substituídos por uma atualização em segundo plano.

Após salvar perfil, agendar, reagendar ou cancelar, o cache recebe os dados confirmados pela resposta da API. Não existe uma segunda leitura obrigatória de toda a conta antes de continuar. Requisições simultâneas de sincronização são agrupadas; respostas anteriores a mudanças de sessão ou gravações são descartadas.

A etapa de horário pré-carrega os três dias visíveis em uma chamada; `GET /api/availability` aceita `dates` com até quatro datas separadas por vírgula (ou o parâmetro individual `date`). O resultado é reutilizado por 15 segundos. Selecionar um horário não repete a consulta enquanto o cache é válido. A reserva continua sendo validada no servidor e pelos índices únicos do banco; um horário exibido pode ter sido ocupado por outra pessoa entre a consulta e a confirmação.

O cache privado permanece em memória da aba, separado por sessão, e é limpo ao sair/trocar de conta. Não foi adicionado cache público ou persistente de respostas privadas. O envio do evento de início do agendamento não bloqueia a abertura da tela. A autenticação de cada pedido também foi reduzida de duas consultas sequenciais ao banco para uma leitura da sessão com o perfil relacionado.

O navegador do usuário também foi usado para login online, escolha do atendimento, confirmação e persistência após recarregar. Relatórios e capturas estão em `evidencias/`. Os relatórios locais anteriores com 19 verificações pertencem à versão 1; não representam uma nova certificação da versão 2. Instalação manual, testes com participantes e certificação WCAG continuam pendentes.

## Referências técnicas

- Vercel Container Runtime: https://vercel.com/docs/functions/runtimes/container
- Supabase API Keys: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase Data API Security: https://supabase.com/docs/guides/api/securing-your-api

Mantemos a distinção entre requisitos dos professores, decisões de implementação e evidências verificadas. Não houve envio ao grupo, professores, Teams ou GitHub.

## Instalação em destaque — versão 2.1.1

A apresentação e o início mostram uma faixa discreta “Instalar aplicativo” antes do conteúdo principal. No computador, o acesso também fica na navegação principal. As cores, fontes e ações de agendamento foram preservadas. A faixa não aparece durante o preenchimento do agendamento nem no modo instalado.

Quando disponível, o botão usa o evento nativo de instalação do navegador uma única vez. Na ausência desse recurso, abre a página de instruções, incluindo o caminho pelo Safari no iPhone/iPad. A instalação efetiva continua sob controle do usuário e do navegador. Nenhuma instalação foi concluída automaticamente.

Validação: estrutura/manifest/ícones/sintaxe, 13 testes existentes e verificação isolada dos caminhos de instalação aprovados. Interface conferida no Chrome em computador, 412 px e 320 px, incluindo fonte ampliada, sem rolagem horizontal. As preferências temporárias de leitura foram restauradas. Cache da interface atualizado para `saude-palma-shell-v2.1.1`.

Referências de implementação: [BeforeInstallPromptEvent](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent) e [appinstalled](https://developer.mozilla.org/en-US/docs/Web/API/Window/appinstalled_event), MDN.
