import express from "express";
import { Server } from "socket.io";
import http from "http";
import { Game } from "./game.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const game = new Game(io);

app.use(express.static("public"));
server.listen(3000, () => console.log("Server running on http://localhost:3000"));
