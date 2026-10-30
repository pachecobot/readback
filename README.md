# Readback — inglês para aviação e viagens, por voz

Você liga para a IA, ela faz o papel do controlador (Ground, Torre, Controle), do examinador do SDEA ou do atendente do aeroporto. Você responde falando, ela entende, responde em voz e corrige sua fala e sua pronúncia.

## O que tem no aplicativo

| Aba | O que faz |
|---|---|
| **Chamada** | Conversa por voz em tempo real com a IA. 8 cenários: táxi/Ground, Torre e circuito, navegação, emergências, simulado SDEA/ICAO, aeroporto e imigração, hotel e cidade, conversa livre. Mostra correções, dicas de pronúncia com IPA, fraseologia e uma estimativa ICAO (1–6) nos 6 critérios. |
| **Pronúncia** | Ouvir e repetir: ~70 frases (alfabeto fonético, números ICAO, fraseologia, emergência, sons difíceis para brasileiros, viagem). Você grava e vê em verde/vermelho quais palavras o reconhecedor entendeu. Botão "Explicar com IA" para dicas de como posicionar boca e língua. |
| **Revisão** | Caderno de erros automático: toda correção das chamadas vira um cartão com repetição espaçada (1, 3, 7, 16, 35 dias). Histórico das chamadas com a nota ICAO. |
| **Referência** | Alfabeto fonético e números com áudio, escala ICAO, palavras-chave da fonia. |

Recursos da chamada:
- **Mãos livres**: fale e faça uma pausa; a IA responde sozinha.
- **Modo rádio (PTT)**: segure o botão (ou a barra de espaço) para transmitir, como no avião.
- **Interromper**: corta a fala da IA e passa a ouvir você.
- **Corrigir em voz** (liga/desliga): a IA corrige no meio da conversa, como um professor, ou só na tela, para manter a imersão.
- **Encerrar com resumo**: a IA fala um resumo e lista os 3 pontos mais importantes para treinar.
- Também dá para digitar, se o microfone não estiver disponível.

## Nota de pronúncia por som (Azure Speech)

Com o Azure configurado, cada fala sua é avaliada **no áudio, som por som**, como no ELSA:
- cada palavra fica verde (≥80), amarela (60–79) ou vermelha (<60), com notas de pronúncia, exatidão, fluência e entonação;
- ao tocar numa palavra você vê a nota de cada som (fonema), qual som você fez no lugar (por exemplo: /ð/ soou como /d/) e a dica em português de boca e língua, com botões "Ouvir certo" e "Devagar";
- as notas vão para a IA, que corrige em voz a pior palavra na hora ("Quick pronunciation tip: weather…"), pede para repetir e elogia quando melhora;
- as vozes da IA passam a ser vozes neurais (naturais), em vez das vozes robóticas do navegador;
- funciona também no iPhone (não depende do reconhecimento do Chrome).

Sem o Azure, o app continua funcionando só com o reconhecimento do navegador (menos preciso).

**Como criar a chave (uns 10 minutos):**
1. Crie uma conta em [portal.azure.com](https://portal.azure.com) (pede cartão para verificar identidade; o plano gratuito não cobra).
2. Pesquise **Speech services** → **Create**.
3. Região: **East US** · Pricing tier: **Free F0** · dê um nome qualquer → **Review + create**.
4. Abra o recurso criado → **Keys and Endpoint** → copie a **KEY 1** e a **Location/Region** (ex.: `eastus`).

## Como rodar no seu computador

1. Instale o [Node.js](https://nodejs.org) (versão LTS).
2. Dê dois cliques em **iniciar-windows.bat** (Windows) ou **iniciar-mac.command** (Mac).
3. Na primeira vez ele abre o arquivo **.env**: cole a chave da Anthropic e a do Azure, salve e feche.
4. Dê dois cliques de novo. Ele instala o que falta (só na primeira vez) e abre **http://localhost:3000** no navegador.
5. Permita o microfone e toque em **Chamar**. Use fone de ouvido.

O modelo padrão é o `claude-haiku-5-5`, o mais barato. Para trocar, mude `ANTHROPIC_MODEL` no arquivo `.env`.

Pelo terminal, se preferir: `npm install` e depois `npm start` (as chaves também são lidas do `.env`).

## Como usar no celular (publicar no Render, grátis)

O microfone só funciona em `https://`. O Render dá esse endereço de graça.

1. Crie a conta em [render.com](https://render.com) entrando com o GitHub.
2. Clique em **New → Blueprint** e escolha o repositório **readback**. O arquivo `render.yaml` já traz tudo configurado.
3. O Render pede três valores: cole `ANTHROPIC_API_KEY`, `AZURE_SPEECH_KEY` e invente uma senha em `APP_PASSWORD`. Clique em **Apply**.
4. Em uns 3 minutos aparece o endereço `https://readback-xxxx.onrender.com`.
5. No celular, abra o endereço (Chrome no Android, Safari no iPhone), digite a senha no campo **Senha do aplicativo** e use **Adicionar à tela inicial** para virar um app.

No plano gratuito, o Render "dorme" depois de 15 minutos sem uso. A primeira abertura depois disso leva cerca de 1 minuto. Depois fica rápido.

## Configurações (variáveis de ambiente)

| Variável | Padrão | Para quê |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Obrigatória para a Chamada. O treino de pronúncia funciona sem ela. |
| `AZURE_SPEECH_KEY` | — | Liga a nota de pronúncia por som e as vozes neurais. |
| `AZURE_SPEECH_REGION` | `eastus` | Região do recurso Speech no Azure. |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Modelo da IA. `claude-haiku-5-5` é muito mais barato e rápido; `claude-sonnet-5-5` fica no meio. |
| `ANTHROPIC_EFFORT` | `low` | Profundidade de raciocínio. `low` responde mais rápido, bom para conversa. |
| `APP_PASSWORD` | vazio | Senha pedida pelo site. Use quando publicar na internet. |
| `PORT` | `3000` | Porta do servidor. |

## Quanto custa

Estimativa para **30 chamadas de 15 minutos por mês** (você fala uns 5 minutos em cada uma):

| Parte | Grátis? | Custo |
|---|---|---|
| Azure: nota de pronúncia + reconhecimento | Plano F0: 5 horas de áudio por mês | 30 chamadas ≈ 2,5 h → **US$ 0** |
| Azure: vozes neurais | Plano F0: 500 mil caracteres por mês | ≈ 150 mil caracteres → **US$ 0** |
| IA (Claude) com `claude-haiku-5-5` | Não | ≈ **US$ 0,30 por mês** |
| IA (Claude) com `claude-sonnet-5-5` | Não | ≈ **US$ 6 por mês** |
| IA (Claude) com `claude-opus-5-5` (padrão) | Não | ≈ **US$ 12 por mês** |

A API da Anthropic é pré-paga: você compra créditos (a partir de US$ 5) e eles vão sendo usados. Se passar do gratuito do Azure, ele cobra cerca de US$ 1,30 por hora de fala sua. Confira os preços atuais nas páginas do Azure e da Anthropic.

## Como funciona por dentro

```
Microfone → Azure Speech (texto + nota por palavra e por som)
           ou reconhecimento do navegador, se o Azure não estiver configurado
         → servidor (server.js) → Claude (resposta em streaming)
         → a parte falada é lida frase a frase pela voz neural do Azure
         → o bloco de feedback (JSON) vira correções, pronúncia e nota ICAO na tela
```

- `prompts.js` — a "metodologia": papel da IA, cenários, regras de correção, fonia ICAO, formato da resposta. É aqui que você ajusta o professor.
- `public/data.js` — frases do treino de pronúncia. Acrescente as suas.
- `public/pron.js` — avaliação de pronúncia do Azure e dicas de cada som em português.
- `public/app.js` — interface, voz, reconhecimento, caderno de erros.
- Seus dados (erros, histórico, notas) ficam só no navegador (localStorage).

### Limites que vale saber

- Com o Azure, a nota de pronúncia é medida no áudio, som por som (o mesmo tipo de tecnologia do ELSA). Sem o Azure, a IA só vê o texto reconhecido e percebe apenas erros que trocam a palavra.
- Na fonia, "tree" (three) e "tou-sand" (thousand) são as formas ICAO: o app não conta isso como erro nos treinos de aviação. No treino "Sons difíceis", conta.
- O reconhecimento de voz funciona melhor no Chrome e no Edge. No iPhone, use o Safari atualizado.
- A nota ICAO é uma estimativa para orientar o treino. Ela não substitui o SDEA.

Veja `PESQUISA.md` para o resumo da pesquisa sobre metodologias, apps e o exame.
