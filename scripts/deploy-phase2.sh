#!/bin/bash

echo "🚀 Deploying Phase 2: Event-Driven Updates"

# Build the dashboard
echo "📦 Building dashboard..."
npm run build-dashboard

# Deploy to Cloud Run
echo "☁️ Deploying to Cloud Run..."
gcloud run deploy signals-dashboard \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="DISCORD_WEBHOOK_URL=https://discordapp.com/api/webhooks/1194064309727277156/UGEhwvhxGKgq8SO6zW1NlunmLIHN0JFjbHXLUA7fkeRX4Di3pJUXsnq1RROq31cPP7vk,FINNHUB_API_KEY=d0hqe5pr01ql9qu6dci0d0hqe5pr01ql9qu6dcig,GCS_BUCKET=signals-db-strange-signals-dashboard,PGHOST=/cloudsql/strange-signals-dashboard:us-central1:signals-postgres,PGUSER=signalsuser,PGPASSWORD=changeme123,PGDATABASE=signalsdb,PGPORT=5432"

# Wait for deployment to be ready
echo "⏳ Waiting for deployment to be ready..."
sleep 30

# Get the service URL
SERVICE_URL=$(gcloud run services describe signals-dashboard --region us-central1 --format 'value(status.url)')
echo "✅ Service deployed at: $SERVICE_URL"

# Update the Cloud Scheduler script with the correct URL
echo "🔧 Updating Cloud Scheduler configuration..."
sed -i '' "s|https://signals-dashboard-106188309454.us-central1.run.app|$SERVICE_URL|g" scripts/setup-cloud-scheduler.js

# Install Cloud Scheduler dependency
echo "📦 Installing Cloud Scheduler dependency..."
npm install @google-cloud/scheduler

# Set up Cloud Scheduler jobs
echo "⏰ Setting up Cloud Scheduler jobs..."
node scripts/setup-cloud-scheduler.js

echo "🎉 Phase 2 deployment completed!"
echo "📊 Monitor your Cloud Run service at: $SERVICE_URL"
echo "⏰ Cloud Scheduler jobs are now managing your updates" 