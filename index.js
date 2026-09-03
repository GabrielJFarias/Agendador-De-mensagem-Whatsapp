const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Mapa dos dias da semana em português -> número usado pelo cron (0=domingo ... 6=sábado)
const DIAS = {
  dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6,
};

function carregarAgenda() {
  const caminho = path.join(__dirname, 'schedule.json');
  const conteudo = fs.readFileSync(caminho, 'utf-8');
  return JSON.parse(conteudo);
}

function validarItem(item, index) {
  const erros = [];
  if (!item.numero) erros.push('numero ausente');
  if (!item.mensagem) erros.push('mensagem ausente');
  if (!item.horario || !/^\d{2}:\d{2}$/.test(item.horario)) erros.push('horario invalido (use HH:mm)');
  if (!Array.isArray(item.dias) || item.dias.length === 0) erros.push('dias ausente ou vazio');
  else {
    for (const d of item.dias) {
      if (!(d in DIAS)) erros.push(`dia invalido: "${d}" (use dom, seg, ter, qua, qui, sex, sab)`);
    }
  }
  if (erros.length > 0) {
    throw new Error(`Item ${index} do schedule.json invalido: ${erros.join(', ')}`);
  }
}

function montarExpressaoCron(horario, dias) {
  const [hora, minuto] = horario.split(':').map(Number);
  const diasCron = dias.map((d) => DIAS[d]).join(',');
  // formato: minuto hora dia-do-mes mes dia-da-semana
  return `${minuto} ${hora} * * ${diasCron}`;
}

function formatarNumero(numero) {
  // remove tudo que não for dígito e garante o sufixo do WhatsApp
  const somenteDigitos = String(numero).replace(/\D/g, '');
  return `${somenteDigitos}@c.us`;
}

async function iniciar() {
  const agenda = carregarAgenda();
  agenda.forEach(validarItem);

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    console.log('\nEscaneie o QR code abaixo com o WhatsApp do celular (Aparelhos conectados > Conectar um aparelho):\n');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    console.log('Autenticado com sucesso. A sessão foi salva em .wwebjs_auth (não precisa escanear de novo nas próximas vezes).');
  });

  client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação:', msg);
  });

  client.on('ready', () => {
    console.log('WhatsApp conectado! Agendando mensagens...\n');

    agenda.forEach((item, index) => {
      const expressao = montarExpressaoCron(item.horario, item.dias);
      const destino = formatarNumero(item.numero);

      console.log(
        `[${index}] "${item.nome || 'sem nome'}" -> ${item.numero} | dias: ${item.dias.join(', ')} | horario: ${item.horario} | cron: "${expressao}"`
      );

      cron.schedule(
        expressao,
        async () => {
          try {
            await client.sendMessage(destino, item.mensagem);
            console.log(`[${new Date().toLocaleString('pt-BR')}] Mensagem "${item.nome}" enviada para ${item.numero}`);
          } catch (erro) {
            console.error(`[${new Date().toLocaleString('pt-BR')}] Erro ao enviar "${item.nome}" para ${item.numero}:`, erro.message);
          }
        },
        { timezone: 'America/Sao_Paulo' }
      );
    });

    console.log('\nTudo agendado. Deixe este processo rodando (ex: com pm2 ou um servidor) para os envios acontecerem.');
  });

  client.on('disconnected', (motivo) => {
    console.log('WhatsApp desconectado:', motivo);
  });

  await client.initialize();
}

iniciar().catch((erro) => {
  console.error('Erro ao iniciar o script:', erro.message);
  process.exit(1);
});
