const io = require("socket.io-client");

const socket_io_url = process.env.SOCKET_IO_URL;

module.exports.initalizeSocketIo = () => {
    const socket = io(socket_io_url);
    return socket;
};
