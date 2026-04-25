const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

let players = []; // { id, name, disconnected }
let story = [];
let turn = 0;
const reconnectTimers = {}; // name -> setTimeout handle
const RECONNECT_GRACE = 300000; // 5 minuti per tornare

function broadcastState() {
  io.emit("players", players.map(p => ({ name: p.name, disconnected: p.disconnected })));
  io.emit("turn", players[turn]?.name);
  io.emit("story", story);
}

io.on("connection", (socket) => {

  socket.on("join", (name) => {
    // Controlla se è una riconnessione
    const existing = players.find(p => p.name === name);
    if (existing) {
      // Cancella il timer di rimozione se c'era
      if (reconnectTimers[name]) {
        clearTimeout(reconnectTimers[name]);
        delete reconnectTimers[name];
      }
      existing.id = socket.id;
      existing.disconnected = false;
    } else {
      players.push({ id: socket.id, name, disconnected: false });
    }

    broadcastState();
  });

  socket.on("word", (word) => {
    if (players[turn]?.id !== socket.id) return;
    if (typeof word !== "string") return;
    const clean = word.trim();
    if (!clean) return;
    // Nessun limite sul numero di parole: la validazione è gestita dal client.

    story.push(clean);

    // Salta i giocatori disconnessi per il turno successivo
    let next = (turn + 1) % players.length;
    let attempts = 0;
    while (players[next]?.disconnected && attempts < players.length) {
      next = (next + 1) % players.length;
      attempts++;
    }
    turn = next;

    io.emit("story", story);
    io.emit("turn", players[turn]?.name);
  });

  socket.on("disconnect", () => {
    const player = players.find(p => p.id === socket.id);
    if (!player) return;

    // Segna come disconnesso ma non rimuovere subito
    player.disconnected = true;
    io.emit("players", players.map(p => ({ name: p.name, disconnected: p.disconnected })));

    // Se era il suo turno, passa al prossimo attivo
    if (players[turn]?.id === socket.id) {
      let next = (turn + 1) % players.length;
      let attempts = 0;
      while (players[next]?.disconnected && attempts < players.length) {
        next = (next + 1) % players.length;
        attempts++;
      }
      if (!players[next]?.disconnected) {
        turn = next;
        io.emit("turn", players[turn]?.name);
      }
    }

    // Dopo 15 secondi, se non è tornato, lo rimuoviamo davvero
    reconnectTimers[player.name] = setTimeout(() => {
      const idx = players.findIndex(p => p.name === player.name);
      if (idx === -1) return;

      players.splice(idx, 1);
      delete reconnectTimers[player.name];

      if (players.length === 0) {
        turn = 0;
      } else {
        if (idx <= turn) {
          turn = Math.max(0, turn - 1);
        }
        turn = turn % players.length;
        let attempts = 0;
        while (players[turn]?.disconnected && attempts < players.length) {
          turn = (turn + 1) % players.length;
          attempts++;
        }
      }

      io.emit("players", players.map(p => ({ name: p.name, disconnected: p.disconnected })));
      io.emit("turn", players[turn]?.name);
    }, RECONNECT_GRACE);
  });
});

http.listen(PORT, () => {
  console.log("Server avviato sulla porta " + PORT);
});
