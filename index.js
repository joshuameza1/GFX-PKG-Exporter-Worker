(require('dotenv')).config();
const worker = require('./worker');

process.on('exit', code => {
  console.log(`Process exited with code: ${code}`)
})

worker.start();
