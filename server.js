const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.IO
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ["https://walkie-talkie-2hhx.onrender.com/", "https://your-custom-domain.com"]
      : ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ["https://walkie-talkie-2hhx.onrender.com/", "https://your-custom-domain.com"]
    : ["http://localhost:3000"],
  credentials: true
}));

app.use(express.json());

// Store rooms and participants
const rooms = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get room info endpoint
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (room) {
    res.json({
      participants: Array.from(room.participants.values()),
      participantCount: room.participants.size
    });
  } else {
    res.json({ participants: [], participantCount: 0 });
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-room', ({ room, userName }) => {
    console.log(`${userName} (${socket.id}) joining room: ${room}`);
    
    // Leave any existing room
    socket.rooms.forEach(roomName => {
      if (roomName !== socket.id) {
        socket.leave(roomName);
        const existingRoom = rooms.get(roomName);
        if (existingRoom) {
          existingRoom.participants.delete(socket.id);
          if (existingRoom.participants.size === 0) {
            rooms.delete(roomName);
          } else {
            // Notify others in the room
            socket.to(roomName).emit('user-left', {
              participants: Array.from(existingRoom.participants.values())
            });
          }
        }
      }
    });

    // Join new room
    socket.join(room);
    
    // Initialize room if it doesn't exist
    if (!rooms.has(room)) {
      rooms.set(room, {
        name: room,
        participants: new Map(),
        createdAt: new Date()
      });
    }

    const roomData = rooms.get(room);
    
    // Add user to room
    roomData.participants.set(socket.id, {
      id: socket.id,
      name: userName,
      isTalking: false,
      joinedAt: new Date()
    });

    // Store user info in socket
    socket.userName = userName;
    socket.currentRoom = room;

    // Send updated participant list to all users in room
    const participants = Array.from(roomData.participants.values());
    io.to(room).emit('user-joined', { participants });

    console.log(`Room ${room} now has ${participants.length} participants`);
  });

  socket.on('start-talking', ({ room }) => {
    console.log(`${socket.userName} started talking in room ${room}`);
    
    const roomData = rooms.get(room);
    if (roomData && roomData.participants.has(socket.id)) {
      // Update user's talking status
      const user = roomData.participants.get(socket.id);
      user.isTalking = true;
      
      // Notify others in room
      socket.to(room).emit('user-talking', {
        userId: socket.id,
        userName: socket.userName,
        isTalking: true
      });
    }
  });

  socket.on('stop-talking', ({ room }) => {
    console.log(`${socket.userName} stopped talking in room ${room}`);
    
    const roomData = rooms.get(room);
    if (roomData && roomData.participants.has(socket.id)) {
      // Update user's talking status
      const user = roomData.participants.get(socket.id);
      user.isTalking = false;
      
      // Notify others in room
      socket.to(room).emit('user-talking', {
        userId: socket.id,
        userName: socket.userName,
        isTalking: false
      });
    }
  });

  // WebRTC signaling
  socket.on('offer', ({ offer, to, room }) => {
    console.log(`Relaying offer from ${socket.id} to ${to} in room ${room}`);
    socket.to(to).emit('offer', {
      offer,
      from: socket.id,
      room
    });
  });

  socket.on('answer', ({ answer, to, room }) => {
    console.log(`Relaying answer from ${socket.id} to ${to} in room ${room}`);
    socket.to(to).emit('answer', {
      answer,
      from: socket.id,
      room
    });
  });

  socket.on('ice-candidate', ({ candidate, to, room }) => {
    console.log(`Relaying ICE candidate from ${socket.id} to ${to}`);
    socket.to(to).emit('ice-candidate', {
      candidate,
      from: socket.id,
      room
    });
  });

  socket.on('leave-room', ({ room }) => {
    console.log(`${socket.userName} leaving room: ${room}`);
    handleUserLeave(socket, room);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (socket.currentRoom) {
      handleUserLeave(socket, socket.currentRoom);
    }
  });

  function handleUserLeave(socket, room) {
    const roomData = rooms.get(room);
    if (roomData) {
      roomData.participants.delete(socket.id);
      
      if (roomData.participants.size === 0) {
        // Delete empty room
        rooms.delete(room);
        console.log(`Room ${room} deleted (empty)`);
      } else {
        // Notify remaining participants
        const participants = Array.from(roomData.participants.values());
        socket.to(room).emit('user-left', { participants });
        console.log(`Room ${room} now has ${participants.length} participants`);
      }
    }
    
    socket.leave(room);
  }
});

// Cleanup empty rooms periodically
setInterval(() => {
  const emptyRooms = [];
  rooms.forEach((room, roomName) => {
    if (room.participants.size === 0) {
      emptyRooms.push(roomName);
    }
  });
  
  emptyRooms.forEach(roomName => {
    rooms.delete(roomName);
    console.log(`Cleaned up empty room: ${roomName}`);
  });
  
  if (emptyRooms.length > 0) {
    console.log(`Active rooms: ${rooms.size}`);
  }
}, 30000); // Check every 30 seconds

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🚀 Walkie-Talkie server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready for connections`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`🔗 Frontend should connect to: http://localhost:${PORT}`);
  }
});