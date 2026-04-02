module.exports = {
  apps: [
    {
      name: 'markup-clone',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
