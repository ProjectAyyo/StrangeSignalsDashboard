const { CloudSchedulerClient } = require('@google-cloud/scheduler');

const client = new CloudSchedulerClient();
const projectId = 'strange-signals-dashboard';
const location = 'us-central1';
const serviceUrl = 'https://signals-dashboard-106188309454.us-central1.run.app';

async function createSchedulerJobs() {
  const parent = `projects/${projectId}/locations/${location}`;
  
  try {
    // Create job for market hours (every 5 minutes during market hours)
    const marketHoursJob = {
      name: `${parent}/jobs/update-alerts-market-hours`,
      description: 'Update trading alerts during market hours',
      schedule: '*/5 9-17 * * 1-5', // Every 5 minutes, 9 AM to 5 PM, Mon-Fri
      timeZone: 'America/New_York',
      httpTarget: {
        uri: `${serviceUrl}/scheduler/update-alerts`,
        httpMethod: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify({ source: 'cloud-scheduler' })).toString('base64'),
      },
    };

    // Create job for after-hours cleanup (once per hour)
    const afterHoursJob = {
      name: `${parent}/jobs/update-alerts-after-hours`,
      description: 'Update trading alerts after market hours',
      schedule: '0 * * * *', // Every hour
      timeZone: 'America/New_York',
      httpTarget: {
        uri: `${serviceUrl}/scheduler/update-alerts`,
        httpMethod: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify({ source: 'cloud-scheduler-after-hours' })).toString('base64'),
      },
    };

    // Create health check job (every 15 minutes)
    const healthCheckJob = {
      name: `${parent}/jobs/health-check`,
      description: 'Health check for the signals dashboard',
      schedule: '*/15 * * * *', // Every 15 minutes
      timeZone: 'America/New_York',
      httpTarget: {
        uri: `${serviceUrl}/scheduler/health`,
        httpMethod: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    };

    console.log('Creating Cloud Scheduler jobs...');

    // Create market hours job
    try {
      const [job] = await client.createJob({
        parent,
        job: marketHoursJob,
      });
      console.log(`✅ Created market hours job: ${job.name}`);
    } catch (err) {
      if (err.code === 6) { // ALREADY_EXISTS
        console.log('⚠️ Market hours job already exists');
      } else {
        console.error('❌ Error creating market hours job:', err.message);
      }
    }

    // Create after hours job
    try {
      const [job] = await client.createJob({
        parent,
        job: afterHoursJob,
      });
      console.log(`✅ Created after hours job: ${job.name}`);
    } catch (err) {
      if (err.code === 6) { // ALREADY_EXISTS
        console.log('⚠️ After hours job already exists');
      } else {
        console.error('❌ Error creating after hours job:', err.message);
      }
    }

    // Create health check job
    try {
      const [job] = await client.createJob({
        parent,
        job: healthCheckJob,
      });
      console.log(`✅ Created health check job: ${job.name}`);
    } catch (err) {
      if (err.code === 6) { // ALREADY_EXISTS
        console.log('⚠️ Health check job already exists');
      } else {
        console.error('❌ Error creating health check job:', err.message);
      }
    }

    console.log('🎉 Cloud Scheduler setup completed!');
  } catch (err) {
    console.error('❌ Error setting up Cloud Scheduler:', err);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  createSchedulerJobs().then(() => {
    console.log('Setup script completed');
    process.exit(0);
  }).catch(err => {
    console.error('Setup script failed:', err);
    process.exit(1);
  });
}

module.exports = { createSchedulerJobs }; 