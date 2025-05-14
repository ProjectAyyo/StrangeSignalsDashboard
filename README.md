# TradingView Webhook Server

A simple Node.js server that receives webhooks from TradingView alerts.

## Setup

1. Install dependencies:
```bash
yarn install
```

2. Create a `.env` file (optional):
```bash
PORT=3000  # Change this if you want to use a different port
```

## Running the Server

Development mode (with auto-reload):
```bash
yarn dev
```

Production mode:
```bash
yarn start
```

## Webhook Endpoint

The server exposes a webhook endpoint at:
```
http://your-server:3000/webhook
```

### Setting up TradingView Alerts

1. In TradingView, create a new alert
2. In the "Webhook URL" field, enter your server's webhook URL
3. In the "Message" field, you can send any JSON data. For example:
```json
{
    "symbol": "{{ticker}}",
    "price": {{close}},
    "strategy": {
        "order_action": "buy",
        "order_contracts": 1,
        "order_price": {{close}}
    }
}
```

## Health Check

The server includes a health check endpoint at:
```
http://your-server:3000/health
```

## Customization

The webhook handler in `server.js` can be customized to:
- Store alerts in a database
- Send notifications
- Execute trades
- Process the data in any way you need

## Security Considerations

For production use, consider:
1. Adding authentication to your webhook endpoint
2. Using HTTPS
3. Implementing rate limiting
4. Adding IP whitelisting
5. Validating the webhook payload 