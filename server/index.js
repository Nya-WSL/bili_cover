'use strict';
const path = require('path');
const express = require('express');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`BiliCover running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
