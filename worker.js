const fs = require('fs');
const {initalizeWatcher} = require("./src/watcher/watcher.js")
const {initalizeSocketIo} = require("./src/socket_io/request.js");
const JsonDB = require("node-json-db").JsonDB;

const {initializeSlackUI, updateSlackAppUI} = require("./src/ae/ae_to_slack.js");
const {generateRenderFiles, processRenderFiles} = require("./src/render/scripts/render_final.js");

exports.start = async () => {
    const watcher = initalizeWatcher();
    const socket = initalizeSocketIo();

    await initializeSlackUI(socket);
    

    // // TRIGGERED WHEN ".AEPX" FILE IS CHANGED
    watcher.on('change', async path => {
        console.log(`FILE UPDATED AT: ${path}`);
        if (path.includes(".aepx")) {
            await initializeSlackUI(socket);
        }
    })
    // TRIGGERED WHEN APP FORMS CONNECTION TO SOCKET BRIDGE
    socket.on("connection", (arg) => {
        console.log(arg);
    })

    let renderQueue = [];

    // TRIGGERED WHEN SOCKET BRIDGE SENDS FINAL REQUEST PACKET
    socket.on("requestFinal", async (request) => {
        console.log(request);
        let {requestKey, jobNames} = await generateRenderFiles(request);
        renderQueue.push({request, requestKey, jobNames});
    });

    const tick = async () => {
        let currentQueue = renderQueue;
        renderQueue = [];
        for (let job of currentQueue) {
            let {request, requestKey, jobNames} = job;
            let result = await processRenderFiles({request, requestKey, jobNames});

            let {filename, fileLink} = result;
            console.log('sending reply to server');
            console.log(fileLink);
            socket.emit("finalDone", [request, filename, fileLink]);
        }
        setTimeout(tick, 1000);
    };
    tick();
}
