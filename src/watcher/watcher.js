const chokidar = require('chokidar');
// const env = require("dotenv");
// env.config();

const watch_folder = process.env.WATCH_FOLDER;

module.exports.initalizeWatcher = () => {
  // Initialize watcher
  const watcher = chokidar.watch(watch_folder, { persistent: true, usePolling: true, alwaysStat: true });
  return watcher;
};
