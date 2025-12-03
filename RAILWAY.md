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

## Solução para Erro 405

Se o erro 405 persistir após o deploy:

1. Acesse os logs do Railway e copie o QR Code
2. Escaneie rapidamente com seu WhatsApp (tem timeout de ~60s)
3. Se falhar 3 vezes, o sistema automaticamente limpa a sessão corrompida
4. Você também pode forçar reset via: `POST /reset`

**Importante**: O erro 405 geralmente ocorre quando:
- A sessão está corrompida
- O QR Code expirou antes de ser escaneado
- Múltiplas tentativas de conexão simultâneas

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
