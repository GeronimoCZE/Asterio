// pm2 process file: pm2 start ecosystem.config.cjs
// Settings (port, SITE_URL, Google client ID, secrets) come from .env, which server.js reads itself.
module.exports = {
  apps: [
    {
      name: 'galacticio',
      script: 'server.js',
      cwd: __dirname,
      // Keep a single process: rate limits are counted in memory and accounts are one JSON file,
      // so cluster mode would split the limits and race on writes.
      exec_mode: 'fork',
      instances: 1,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
      kill_timeout: 6000,          // time for server.js to save accounts and close connections
      exp_backoff_restart_delay: 200,
      time: true,                  // timestamps in pm2 logs
      merge_logs: true,
    },
  ],
};
