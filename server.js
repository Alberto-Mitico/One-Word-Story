const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

let players = [];   // { id, name, disconnected }
let story = [];
let turn = 0;
let lastAuthor = ""; // nome di chi ha scritto l'ultima parola

const reconnectTimers = {};
const RECONNECT_GRACE = 300000; // 5 minuti

// Invia lo stato completo a tutti
function broadcastState() {
  io.emit("players", players.map(p => ({ name: p.name, disconnected: p.disconnected })));
  io.emit("turn", players[turn]?.name);
  io.emit("story", { words: story, lastAuthor });
}

// Avanza il turno saltando i disconnessi
function advanceTurn() {
  let next = (turn + 1) % players.length;
  let attempts = 0;
  while (players[next]?.disconnected && attempts < players.length) {
    next = (next + 1) % players.length;
    attempts++;
  }
  turn = next;
}

io.on("connection", (socket) => {

  // ── Entrata in partita ──
  socket.on("join", (name) => {
    const existing = players.find(p => p.name === name);
    if (existing) {
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

  // ── Chat libera ──
  socket.on("chat", ({ name, text }) => {
    if (!name || typeof text !== "string") return;
    const clean = text.trim();
    if (!clean) return;
    io.emit("chat", { name, text: clean, time: Date.now() });
  });

  // ── Invio parola ──
  socket.on("word", (word) => {
    if (players[turn]?.id !== socket.id) return;
    if (typeof word !== "string") return;
    const clean = word.trim();
    if (!clean) return;

    const player = players[turn];
    story.push(clean);
    lastAuthor = player.name;

    advanceTurn();

    io.emit("story", { words: story, lastAuthor });
    io.emit("turn", players[turn]?.name);
  });

  // ── Salta turno ──
  socket.on("skip", () => {
    if (players[turn]?.id !== socket.id) return;
    advanceTurn();
    io.emit("turn", players[turn]?.name);
  });

  // ── Annulla ultima parola ──
  socket.on("undo", (name) => {
    const player = players.find(p => p.id === socket.id);
    if (!player || player.name !== name) return;
    if (lastAuthor !== name) return;
    if (story.length === 0) return;

    story.pop();
    lastAuthor = "";

    // Ridà il turno a chi ha annullato
    const idx = players.findIndex(p => p.name === name);
    if (idx !== -1) turn = idx;

    io.emit("story", { words: story, lastAuthor });
    io.emit("turn", players[turn]?.name);
  });

  // ── Disconnessione ──
  socket.on("disconnect", () => {
    const player = players.find(p => p.id === socket.id);
    if (!player) return;

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

    // Dopo il grace period, rimuove definitivamente
    reconnectTimers[player.name] = setTimeout(() => {
      const idx = players.findIndex(p => p.name === player.name);
      if (idx === -1) return;

      players.splice(idx, 1);
      delete reconnectTimers[player.name];

      if (players.length === 0) {
        turn = 0;
      } else {
        if (idx <= turn) turn = Math.max(0, turn - 1);
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
