const os = require('os');
const path = require('path');

module.exports = {
  socketIoUrl: process.env.SOCKET_IO_URL,
  watchFolder: process.env.WATCH_FOLDER,
  renderFolder: process.env.RENDER_FOLDER,
  cdnUrl: process.env.CDN_URL,
  nexrenderWorkpath: process.env.NEXRENDER_WORKPATH || path.join(os.tmpdir(), 'nexrender'),
  aerenderPath: process.env.AERENDER_PATH || '',
  debug: process.env.DEBUG === 'true',
};
