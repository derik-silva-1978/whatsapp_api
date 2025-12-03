# WhatsApp API - Configuração Railway

## Variáveis de Ambiente Necessárias

Adicione estas variáveis no Railway:

```
PORT=3000
N8N_WEBHOOK_URL=https://seu-n8n.com/webhook/titnauta
```

## Volume Persistente

**CRÍTICO**: Configure um volume no Railway para manter a sessão do WhatsApp:

1. Vá em Settings → Volumes
2. Clique em "New Volume"
3. Configure:
   - **Mount Path**: `/app/auth_info`
   - **Size**: 1GB (suficiente)

Sem o volume, você precisará escanear o QR Code a cada restart.

## Deploy

O Railway detecta automaticamente o `package.json` e executa:
- `npm install` (instalação)
- `npm start` (execução)

## Logs

Após o deploy, verifique os logs para:
1. Ver o QR Code (escaneie com seu WhatsApp)
2. Confirmar que a conexão foi estabelecida
3. Monitorar mensagens recebidas/enviadas

## Endpoints

- `GET /` - Health check
- `POST /sendText` - Enviar mensagens

Exemplo de requisição:
```json
POST /sendText
{
  "numero": "5511999999999",
  "mensagem": "Olá!"
}
```
