# Signals Dashboard

This project is a serverless trading signals dashboard and webhook system. It receives trading alerts (e.g., from TradingView), stores them, fetches interval prices to evaluate alert accuracy, and provides a dashboard for visualization. Alerts are also forwarded to Discord. The backend is deployed on Google Cloud Run and supports custom domains.

## Setup

1. Install dependencies:
```bash
yarn install
```

2. Create a `.env` file (optional):
```bash
PORT=3000  # Change this if you want to use a different port
DB_HOST=localhost  # Database host
DB_USER=root      # Database user
DB_PASSWORD=      # Database password
DB_NAME=signals_dashboard  # Database name
```

## Database Setup

### Local Development
1. Install MySQL if you haven't already
2. Create a new database:
```sql
CREATE DATABASE signals_dashboard;
```
3. Update the `.env` file with your database credentials

### Production (Cloud SQL)
1. Create a Cloud SQL instance in your Google Cloud project
2. Add the following secrets to your GitHub repository:
   - `DB_HOST`: Cloud SQL instance connection name
   - `DB_USER`: Database user
   - `DB_PASSWORD`: Database password
   - `DB_NAME`: Database name
   - `CLOUDSQL_INSTANCE`: Cloud SQL instance name

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