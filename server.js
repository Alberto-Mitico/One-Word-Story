const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

let players = [];
let story = [];
let turn = 0;

io.on("connection", (socket) => {
  socket.on("join", (name) => {
    players.push({ id: socket.id, name });
    io.emit("players", players.map(p => p.name));
    io.emit("turn", players[turn]?.name);
    io.emit("story", story);
  });

  socket.on("word", (word) => {
    if (players[turn]?.id !== socket.id) return;

    story.push(word);
    turn = (turn + 1) % players.length;

    io.emit("story", story);
    io.emit("turn", players[turn]?.name);
  });

  socket.on("disconnect", () => {
    const disconnectedIndex = players.findIndex(p => p.id === socket.id);
    players = players.filter(p => p.id !== socket.id);

    if (players.length === 0) {
      turn = 0;
    } else {
      // If the disconnected player was before or at the current turn,
      // adjust turn so the same next player still goes
      if (disconnectedIndex <= turn) {
        turn = (turn - 1 + players.length) % players.length;
      }
      // Keep turn in bounds
      turn = turn % players.length;
    }

    io.emit("players", players.map(p => p.name));
    io.emit("turn", players[turn]?.name); // <-- this was missing!
  });
});

http.listen(PORT, () => {
  console.log("Server avviato sulla porta " + PORT);
});
